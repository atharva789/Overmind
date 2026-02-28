import React from "react";
import type { Connection } from "../connection.js";
import type { Session } from "../session.js";
interface AppProps {
    connection: Connection;
    session: Session;
}
export default function App({ connection, session }: AppProps): React.ReactElement;
export {};
