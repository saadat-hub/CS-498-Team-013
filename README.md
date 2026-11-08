# Prompt Lab

**Learn to give AI clearer instructions—and build programs you understand.**

Prompt Lab is a learning website with 20 challenges across five levels. Start with a simple request, work up to debugging and small applications, and explore practical machine-learning exercises along the way.

## How it works

1. **Choose a challenge.** Read the task and see what a good answer needs to include.
2. **Write your prompt.** Get helpful checks while you type. Your work saves automatically when you are signed in.
3. **Get feedback.** Submit your work, see what passed, and improve anything that needs another try.
4. **Track your progress.** Earn XP, unlock badges, and keep your best prompts in your library.

You can explore the challenges without an account. Sign in to save your work and progress.

## Try it on your computer

You do not need to buy a server to try Prompt Lab.

1. Install [Node.js](https://nodejs.org/en/download), version 22.15 or newer.
2. Download this project and open its folder in a terminal, such as PowerShell.
3. Run these two commands, one at a time:

   ```sh
   npm ci
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser.
5. Click **Start your journey**, then **Start local session**.

The first command installs what the project needs. The second starts the website. Keep the terminal open while you use it; press **Ctrl+C** when you want to stop.

On Windows, you can also start the project with `Start-PromptLab.ps1`.

## What you can use

- A dashboard with your progress, activity, and achievements.
- Five learning levels and a searchable challenge collection.
- A writing workspace with hints, saved drafts, and feedback.
- Your past attempts and a personal prompt library.
- A leaderboard, daily challenges, and account settings.

The original beginner challenges work locally without paying for an AI service. Challenges that need AI feedback require an AI service connection first. The website tells you when that connection is missing.

Your local progress stays on your computer. An online version needs its own setup to save everyone's progress. AI usage can cost money even when the website's hosting is free.

## Put it online

See the [step-by-step hosting guide](docs/HOSTING.md) for free hosting options and the setup process.

## Information for the development team

The technical details are kept separate so this page stays easy to read:

- [Running and deploying the app](docs/DEPLOYMENT.md)
- [Adding and reviewing challenges](docs/CONTENT.md)
- [How the website connects to its services](docs/FRONTEND.md)
- [Project requirements](backend.md)
- [Working together on the code](docs/GITHUB.md)
