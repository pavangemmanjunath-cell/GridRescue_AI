import { api } from '../api/client'
import type { Assessment } from '../api/types'

/** File name for a site's report: GridRescue_ESG_<facility or place>.html */
export const esgFileName = (a: Assessment) =>
  `GridRescue_ESG_${(a.inputs?.facility?.name || a.location?.name || 'site').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}.html`

/**
 * Download the ESG report for the site in this assessment (the location the user picked): scope 1 and 2 split, the
 * E · S · G lines, the Three A's when the relocation plan ran, and the carbon value at the buyer's price if one was entered.
 * The file is a self-contained page with a "Save as PDF / print" button.
 */
export async function downloadEsgReport(a: Assessment, carbonPrice?: number | null, design?: { optionId?: string | null; lens?: string | null }) {
  const html = await api.esgReport(a, carbonPrice, design?.optionId, design?.lens)
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  const el = document.createElement('a'); el.href = url; el.download = esgFileName(a); el.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
