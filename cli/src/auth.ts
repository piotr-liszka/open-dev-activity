import { password, confirm } from '@inquirer/prompts';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { createAppAuth } from "@octokit/auth-app";

// Re-load env to ensure we get fresh values if updated
dotenv.config();

export interface AuthResult {
    token: string;
    method: 'github-app' | 'personal-token';
}

export async function getGitHubToken(): Promise<AuthResult | undefined> {
    // Try GitHub App first
    const appToken = await getGitHubAppToken();
    if (appToken) {
        return { token: appToken, method: 'github-app' };
    }

    let token = process.env.GITHUB_TOKEN;

    if (token) {
        return { token, method: 'personal-token' };
    }

    console.log(chalk.yellow('! GITHUB_TOKEN not found in environment.'));

    // Interactive prompt
    const inputToken = await password({
        message: 'Please enter your GitHub Personal Access Token:',
        mask: '*',
    });

    if (!inputToken) {
        return undefined;
    }

    // Ask to save
    const shouldSave = await confirm({
        message: 'Would you like to save this token to .env for future use?',
        default: true
    });

    if (shouldSave) {
        saveTokenToEnv(inputToken);
    }

    return { token: inputToken, method: 'personal-token' };
}

async function getGitHubAppToken(): Promise<string | undefined> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

    if (!appId || !privateKeyRaw || !installationId) {
        return undefined;
    }

    let privateKey = privateKeyRaw;

    // Clean up potentially wrapped quotes from .env which dotenv might leave if malformed
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
        privateKey = privateKey.slice(1, -1);
    }

    // If it looks like a path (doesn't start with typical PEM header), try to read it
    if (!privateKey.includes('-----BEGIN')) {
        // Resolve path: if absolute use as is, if relative, try relative to cwd
        const resolvedPath = path.isAbsolute(privateKey) ? privateKey : path.resolve(process.cwd(), privateKey);

        if (fs.existsSync(resolvedPath)) {
            try {
                privateKey = fs.readFileSync(resolvedPath, 'utf-8');
            } catch (e) {
                console.warn(chalk.yellow(`Warning: Could not read private key file at ${resolvedPath}`));
            }
        } else {
            // If file doesn't exist, and it doesn't look like a key, it might be a key with missing headers or just garbage path.
            // We'll proceed, but it will likely fail.
        }
    }

    // Fix newlines: 
    // 1. Literal "\n" characters (common in .env) -> real newlines
    // 2. Carriage returns removal just in case
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r/g, '');

    try {
        const auth = createAppAuth({
            appId,
            privateKey,
            installationId,
        });

        // Get an installation access token
        const authentication = await auth({ type: "installation" });
        return authentication.token;
    } catch (error: any) {
        // Log detailed error for debugging if needed, but keep it user friendly
        console.warn(chalk.yellow(`Failed to authenticate with GitHub App: ${error.message}`));
        if (error.message.includes('error:1E08010C')) {
            console.warn(chalk.yellow('Hint: The private key format seems incorrect. Ensure it is a valid PEM key with proper newlines.'));
        }
        return undefined;
    }
}

function saveTokenToEnv(token: string) {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // Check if GITHUB_TOKEN exists (even empty)
    const tokenRegex = /^GITHUB_TOKEN=.*$/m;

    if (tokenRegex.test(envContent)) {
        envContent = envContent.replace(tokenRegex, `GITHUB_TOKEN=${token}`);
    } else {
        envContent += `\nGITHUB_TOKEN=${token}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log(chalk.green('✔ Token saved to .env'));

    // Update process.env for current session
    process.env.GITHUB_TOKEN = token;
}
