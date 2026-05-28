import prompts from "prompts";

export interface InitAnswers {
  platform_url: string;
  hermes_url: string;
  hermes_model: string;
  hermes_api_key: string;
}

export async function promptForConfig(): Promise<InitAnswers> {
  const questions: Array<prompts.PromptObject<string>> = [
    {
      type: "text",
      name: "platform_url",
      message: "Platform URL",
      validate: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          return "Please enter a valid URL (e.g., http://localhost:18090)";
        }
      },
    },
    {
      type: "text",
      name: "hermes_url",
      message: "Hermes URL",
      validate: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          return "Please enter a valid URL (e.g., http://localhost:8642)";
        }
      },
    },
    {
      type: "text",
      name: "hermes_model",
      message: "Hermes Model",
      initial: "hermes-agent",
      validate: (value: string) => value.trim().length > 0 || "Model name cannot be empty",
    },
    {
      type: "password",
      name: "hermes_api_key",
      message: "Hermes API Key (optional - press Enter to skip)",
    },
  ];

  const answers = await prompts(questions, { onCancel: () => process.exit(0) });

  return {
    platform_url: answers.platform_url.trim(),
    hermes_url: answers.hermes_url.trim(),
    hermes_model: answers.hermes_model.trim(),
    hermes_api_key: answers.hermes_api_key?.trim() || "",
  };
}

export async function promptOverwrite(configPath: string): Promise<boolean> {
  const { overwrite } = await prompts({
    type: "confirm",
    name: "overwrite",
    message: `Config already exists at ${configPath}. Overwrite?`,
    initial: false,
  });
  return overwrite === true;
}
