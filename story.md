# Overmind

Overmind is a unique multiplayer terminal coding REPL (Read-Eval-Print Loop) designed for collaborative development. It enables a team of developers to connect to a shared session, submit prompts, review them collectively, and then have an AI agent execute the requested changes directly within the host's project directory.

## Core Features

*   **Multiplayer Terminal Collaboration:** Overmind provides a shared, interactive terminal environment where multiple developers can connect in real-time, fostering a collaborative coding experience.
*   **AI-Powered Code Execution:** The application integrates with Google Gemini AI agents to interpret natural language prompts from users and execute code modifications, generate new code, or perform other development tasks directly on the host's file system.
*   **Prompt Management and Review Workflow:** Developers can submit tasks or requests as prompts, which can then be reviewed by the team. This allows for collaborative oversight before the AI agent implements changes.
*   **Direct Project Modification:** AI-generated changes are applied directly to the host machine's project directory, ensuring that all modifications are immediately reflected in the codebase being worked on.
*   **Flexible Session Hosting and Joining:** Users can host a development session, generating a unique "Party Code" for others to join. Connectivity is supported over local networks and can be extended globally via ngrok tunnels.
*   **Interactive Terminal User Interface (TUI):** Built with modern UI frameworks for the terminal, Overmind offers a rich and responsive user experience within the command line interface.
*   **Real-time Communication:** Utilizes WebSockets for real-time data exchange, enabling instantaneous updates and interactions across all connected participants.
*   **Persistent Session Data (Implied):** Integration with PostgreSQL suggests capabilities for storing session-related data, such as prompts, user actions, or other collaborative information.