/**
 * Card status vocabulary shared by the views that render a status chip.
 *
 * "Shipped" = built or verified; everything else (planned / building / no
 * status at all) is still ahead.
 */
export const SHIPPED = new Set(['built', 'verified']);

// Same status → Badge mapping CardPage uses, so a status reads identically on
// both pages (Badge has no success/warning variant — those arrive as `!` token
// utilities that win on source order).
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
