// One stroke weight for every glyph in the workspace.
const base = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const CheckIcon = () => <svg {...base}><path d="M2.5 6.3 4.9 8.6 9.5 3.6" /></svg>
export const ExternalIcon = () => <svg {...base} width={10} height={10}><path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" /></svg>
