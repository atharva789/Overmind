# Overmind

Overmind is a multiplayer terminal coding REPL that allows a team of developers to connect, submit prompts, review them, and have an AI agent execute the changes directly in the host's project directory.

## Installation

Because the CLI currently acts on the host's local directory, it must be installed globally if you want to run it outside of this project repository.

1. Clone the repository:
   ```bash
   git clone git@github.com:atharva789/Overmind.git
   cd Overmind
   ```

2. Install dependencies and build the TypeScript code:
   ```bash
   npm ci
   npm run build
   ```

3. Link the CLI globally so the `overmind` command is available anywhere:
   ```bash
   npm link
   ```

Now you can use `overmind` in any project folder on your computer!

## 🌐 Hosting a Session (For the Host)

The host machine is where the actual code modifications will be made.

1. Navigate to the project directory you want the team to work on.
2. Ensure you have the Gemini API key exported if you want the agents to function:
   ```bash
   export GEMINI_API_KEY="your-api-key"
   ```
3. Start the host session:
   ```bash
   overmind host --port 4444
   ```
   *This generates a 4-letter Party Code (e.g., ABCD).*

### Sharing Over the Internet (Using Ngrok)

By default, only people on your local Wi-Fi or local network can join using your local IP address. To let anyone in the world join, use an **ngrok** tunnel:

1. Install ngrok via `snap install ngrok` or from [ngrok.com](https://ngrok.com/download).
2. Authenticate ngrok with your account:
   ```bash
   ngrok config add-authtoken <YOUR_TOKEN>
   ```
3. While your Overmind host is running, open a **second terminal tab** and run:
   ```bash
   ngrok tcp 4444
   ```
4. Ngrok will give you a "Forwarding" output that looks like this:
   `tcp://4.tcp.ngrok.io:14680 -> localhost:4444`

**Share the ngrok URL (e.g., `4.tcp.ngrok.io`), the ngrok port (e.g., `14680`), and your Overmind Party Code with your friends.**

---

## 🤝 Joining a Session (For Teammates)

To join an existing Overmind session, teammates must first follow the Installation steps above to get the `overmind` command on their computer.

Once installed, they can run the `join` command from any directory.

### Joining via Ngrok (Over the Internet)
Using the details the host provided from ngrok:
```bash
overmind join <PARTY_CODE> --server 4.tcp.ngrok.io --port 14680 -u "YourDisplayName"
```

### Joining via Local Network (Same Wi-Fi)
If you are on the same Wi-Fi as the host, you can connect directly using their local IP address:
```bash
overmind join <PARTY_CODE> --server 192.168.1.50 --port 4444 -u "YourDisplayName"
```
