/**
 * Direct staff corrections to the public archive, each recorded with a reason and undoable.
 * The work is split by record type under ./staff-edits/; this file is the public entry point.
 */
export { applyStaffChanges, type StaffChange } from './staff-edits/core';
export * from './staff-edits/people';
export * from './staff-edits/places';
export * from './staff-edits/records';
export * from './staff-edits/contributions';
export * from './staff-edits/deletion';
export * from './staff-edits/history';
