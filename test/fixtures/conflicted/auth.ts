// Async auth — returns a Promise for DB lookup
export async function login(
    user: string,
    password: string
): Promise<boolean> {
    if (!user || !password) return false;
    // Simulates async DB check
    await new Promise((r) => setTimeout(r, 10));
    return user === "admin" && password === "secret";
}

export function logout(): void {
    console.log("logged out");
}

export function refreshToken(token: string): string {
    return token + "-refreshed";
}