import { openai } from "@ai-sdk/openai";
import { ModelMessage, stepCountIs, streamText, tool } from "ai";
import "dotenv/config";
import fs from "fs/promises";
import * as readline from "node:readline/promises";
import z from "zod";

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages: ModelMessage[] = [
  {
    role: "system",
    content:
      "You are a coding agent. You will be working with js/ts projects. Your responses must be concise. If the task requires it, you can use tools consecutively. E.g. if the user asks for all the ts files in the project, you can first list_files, then read each file with read_file, then finally respond.\n/no_think",
  },
];

async function main() {
  while (true) {
    const userInput = await terminal.question("You: ");

    messages.push({ role: "user", content: userInput });

    const result = streamText({
      model: openai("gpt-4.1-mini"),
      messages,
      stopWhen: stepCountIs(5),
      tools: {
        read_file: tool({
          description:
            "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
          parameters: z.object({
            path: z
              .string()
              .describe(
                "The relative path of a file in the working directory.",
              ),
          }),
          execute: async ({ path }) => {
            try {
              const data = await fs.readFile(path);
              return { path, content: data.toString() };
            } catch (error) {
              console.error(`Error reading file at ${path}:`, error.message);
              return { path, error: error.message };
            }
          },
        }),
        list_files: tool({
          description:
            "List files and directories at a given path. If no path is provided, lists files in the current directory.",
          parameters: z.object({
            path: z
              .string()
              .nullable()
              .describe(
                "Optional relative path to list files from. Defaults to current directory if not provided.",
              ),
          }),
          execute: async ({ path }) => {
            if (path === ".git" || path === "node_modules") {
              return { error: "You cannot read the path: ", path };
            }
            try {
              const results = await fs.readdir(
                path && path.length > 0 ? path : ".",
                {
                  withFileTypes: true,
                },
              );

              return results;
            } catch (e) {
              return { error: e };
            }
          },
        }),
        edit_file: tool({
          description:
            "Make edits to a text file. Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other. If the file specified with path doesn't exist, it will be created.",
          parameters: z.object({
            path: z.string().describe("The path to the file"),
            old_str: z
              .string()
              .describe(
                "Text to search for - must match exactly and must only have one match exactly",
              ),
            new_str: z.string().describe("Text to replace old_str with"),
          }),
          execute: async ({ path, old_str, new_str }) => {
            try {
              const content = await fs.readFile(path, "utf-8").catch(() => "");
              const updatedContent = content.replace(old_str, new_str);
              if (content === updatedContent && old_str !== new_str) {
                return { error: `String "${old_str}" not found in file` };
              }
              await fs.writeFile(path, updatedContent);
              return { success: true };
            } catch (e) {
              return { error: e };
            }
          },
        }),
      },
    });

    process.stdout.write("\nAssistant: ");
    for await (const delta of result.fullStream) {
      if (delta.type === "text") {
        process.stdout.write(delta.text);
      }
      if (delta.type === "tool-call") {
        console.log("Calling tool: " + delta.toolName);
      }
    }
    process.stdout.write("\n\n");

    const { messages: responseMessages } = await result.response;
    messages.push(...responseMessages);
  }
}

main().catch(console.error);
