/**
 * Project color presets and validation utilities.
 * Used to associate accent colors with individual projects.
 */

export interface ProjectColorPreset {
  name: string
  hex: string
}

export const PROJECT_COLOR_PRESETS: ProjectColorPreset[] = [
  { name: 'Red', hex: '#e74c3c' },
  { name: 'Orange', hex: '#e67e22' },
  { name: 'Amber', hex: '#f1c40f' },
  { name: 'Green', hex: '#27ae60' },
  { name: 'Teal', hex: '#1abc9c' },
  { name: 'Blue', hex: '#3498db' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Slate', hex: '#64748b' },
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isValidProjectColor(color: string): boolean {
  return HEX_RE.test(color)
}

export function getProjectAccentCSS(color: string | undefined): string {
  if (!color) return ''
  return `--clui-project-accent: ${color}`
}
