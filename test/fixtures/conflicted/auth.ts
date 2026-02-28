// Sync auth — returns boolean directly
export function login(user: string, password: string): boolean {
    if (!user || !password) return false;
    return user === "admin" && password === "secret";
}

export function logout(): void {
    console.log("logged out");
}
