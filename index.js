/**
 * dsh-task-cost — Host half.
 *
 * Intentionally empty: the whole feature lives in the browser half
 * (`./client.js`), which the Web client module system picks up through this
 * package's `dsh.client` declaration. Keeping a Host half present gives the
 * package a Loader row, which is what the client module graph scans.
 */

/** Host loader entry for the browser implementation exported from `./client`. */
export function apply() {}
