/** Pure state of the storefront error boundary (extracted so it is unit-testable without a DOM). */
export type ShellBoundaryState = { failed: boolean };

export const initialShellState: ShellBoundaryState = { failed: false };

/** getDerivedStateFromError: any render error flips the boundary to its fallback. */
export const shellFailed = (): ShellBoundaryState => ({ failed: true });

/** Retry: leave the fallback and render the children again (after a router refresh re-fetched the data). */
export const shellRetried = (): ShellBoundaryState => initialShellState;

/** The only thing ever logged: a fixed string, never the error object (it can carry DB details). */
export const SHELL_ERROR_LOG = "[storefront] the shell failed to load";
