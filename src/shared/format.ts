/** Format nominal Rp ribu: 15000 -> "Rp15.000rb" */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}Rp${Math.abs(Math.round(n)).toLocaleString('id-ID').replace(/,/g, '.')}rb`;
}
