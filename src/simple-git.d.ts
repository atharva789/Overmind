/**
 * Purpose: Provide a minimal type shim for simple-git in offline installs.
 * High-level behavior: Declares the default export as an untyped factory.
 * Assumptions: Runtime module may or may not be installed.
 * Invariants: This file adds types only, no runtime side effects.
 */

declare module "simple-git" {
    const simpleGit: any;
    export default simpleGit;
}
