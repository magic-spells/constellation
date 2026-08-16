/**
 * Card status vocabulary shared by the views that render a status chip.
 *
 * "Shipped" = built or verified; everything else (planned / building / no
 * status at all) is still ahead.
 */
export const SHIPPED = new Set(['built', 'verified']);

// The status → Badge mapping every read-only status chip renders from, so a
// status reads identically wherever it appears (Badge has no success/warning
// variant — those arrive as `!` token utilities that win on source order).
// StatusSelect.pzl keeps its own near-identical copy: it is the editable
// control and owns the option list, so it does not import from here.
export const STATUS = {
	planned: { variant: 'outline', tint: 'text-muted!' },
	building: { variant: 'default', tint: 'bg-warning-tint! text-warning!' },
	built: { variant: 'brand', tint: '' },
	verified: { variant: 'default', tint: 'bg-success-tint! text-success!' },
};

/** Badge variant + tint for a status, with the neutral fallback for unknowns. */
export function statusMeta(status) {
	return STATUS[status] ?? { variant: 'default', tint: '' };
}
