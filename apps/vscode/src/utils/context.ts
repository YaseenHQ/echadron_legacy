import * as vscode from "vscode";
import type { KimiHarness } from "@yaseenhq/echadron-sdk";

export async function updateLoginContext(harness: KimiHarness): Promise<boolean> {
  const status = await harness.auth.status();
  const loggedIn = status.providers.some((provider) => provider.hasToken);
  await vscode.commands.executeCommand("setContext", "echadron.isLoggedIn", loggedIn);
  return loggedIn;
}
