// One stroke weight for every glyph in the workspace.
const base = { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const ExternalIcon = () => <svg {...base} width={10} height={10}><path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" /></svg>
export const SearchIcon = () => <svg {...base} width={11} height={11}><circle cx="5" cy="5" r="3.5" /><path d="M7.6 7.6 10.5 10.5" /></svg>
