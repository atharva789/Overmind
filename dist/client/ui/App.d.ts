import React from "react";
import type { Connection } from "../connection.js";
import type { Session } from "../session.js";
interface AppProps {
    connection: Connection;
    session: Session;
    inviteCode?: string;
}
export default function App({ connection, session, inviteCode }: AppProps): React.ReactElement;
export {};
