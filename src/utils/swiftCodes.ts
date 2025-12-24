/**
 * SWIFT/BIC codes for banks in cross-border payout countries
 * Used to help users find their bank's SWIFT code before Stripe onboarding
 *
 * Sources:
 * - https://monierate.com/blog/all-banks-swift-codes-in-nigeria-plus-what-is-swift-code
 * - https://www.theswiftcodes.com/south-africa/
 * - https://wise.com/gb/swift-codes/countries/kenya/
 */

export interface BankInfo {
  name: string
  swiftCode: string
}

export interface CountryBanks {
  countryCode: string
  countryName: string
  banks: BankInfo[]
}

export const SWIFT_CODE_DATA: CountryBanks[] = [
  {
    countryCode: 'NG',
    countryName: 'Nigeria',
    banks: [
      { name: 'Access Bank', swiftCode: 'ABNGNGLA' },
      { name: 'EcoBank', swiftCode: 'ECOCNGLA' },
      { name: 'Fidelity Bank', swiftCode: 'FIDTNGLA' },
      { name: 'First Bank', swiftCode: 'FBNINGLA' },
      { name: 'FCMB', swiftCode: 'FCMBNGLA' },
      { name: 'Globus Bank', swiftCode: 'GLOUNGLA' },
      { name: 'GTBank', swiftCode: 'GTBINGLA' },
      { name: 'Heritage Bank', swiftCode: 'HBCLNGLA' },
      { name: 'Keystone Bank', swiftCode: 'PLNINGLA' },
      { name: 'Kuda Bank', swiftCode: 'KUDANGLA' },
      { name: 'Polaris Bank', swiftCode: 'PRDTNGLA' },
      { name: 'Providus Bank', swiftCode: 'UMPLNGLA' },
      { name: 'Stanbic IBTC', swiftCode: 'SBICNGLX' },
      { name: 'Sterling Bank', swiftCode: 'NAMENGLA' },
      { name: 'UBA', swiftCode: 'UNAFNGLA' },
      { name: 'Union Bank', swiftCode: 'UBNINGLA' },
      { name: 'Unity Bank', swiftCode: 'ICITNGLA' },
      { name: 'Wema Bank', swiftCode: 'WEMANGLA' },
      { name: 'Zenith Bank', swiftCode: 'ZEIBNGLA' },
    ],
  },
  {
    countryCode: 'ZA',
    countryName: 'South Africa',
    banks: [
      { name: 'ABSA Bank', swiftCode: 'ABSAZAJJ' },
      { name: 'African Bank', swiftCode: 'AFRCZAJJ' },
      { name: 'Bidvest Bank', swiftCode: 'BIDBZAJJ' },
      { name: 'Capitec Bank', swiftCode: 'CABLZAJJ' },
      { name: 'Discovery Bank', swiftCode: 'DISCZAJJ' },
      { name: 'FNB (First National Bank)', swiftCode: 'FIRNZAJJ' },
      { name: 'Investec Bank', swiftCode: 'INVEZAJJ' },
      { name: 'Nedbank', swiftCode: 'NEDSZAJJ' },
      { name: 'Standard Bank', swiftCode: 'SBZAZAJJ' },
      { name: 'TymeBank', swiftCode: 'ABORZA22' },
    ],
  },
  {
    countryCode: 'KE',
    countryName: 'Kenya',
    banks: [
      { name: 'ABSA Bank Kenya', swiftCode: 'BARCKENX' },
      { name: 'Bank of Africa Kenya', swiftCode: 'AFRIKENX' },
      { name: 'Citibank Kenya', swiftCode: 'CITIKENA' },
      { name: 'Co-operative Bank', swiftCode: 'KCOOKENA' },
      { name: 'Equity Bank', swiftCode: 'EQBLKENA' },
      { name: 'I&M Bank', swiftCode: 'IMBLKENA' },
      { name: 'KCB Bank', swiftCode: 'KCBLKENX' },
      { name: 'NCBA Bank', swiftCode: 'CBAFKENX' },
      { name: 'Stanbic Bank Kenya', swiftCode: 'SBICKENX' },
      { name: 'Standard Chartered Kenya', swiftCode: 'SCBLKENX' },
    ],
  },
  {
    countryCode: 'GH',
    countryName: 'Ghana',
    banks: [
      { name: 'Absa Bank Ghana', swiftCode: 'BABORUGHGHAC' },
      { name: 'Access Bank Ghana', swiftCode: 'ABOROUGHGHAC' },
      { name: 'CAL Bank', swiftCode: 'ACABORUGHGHAC' },
      { name: 'Ecobank Ghana', swiftCode: 'EABORUGHGHAC' },
      { name: 'Fidelity Bank Ghana', swiftCode: 'FABORUGHGHAC' },
      { name: 'GCB Bank', swiftCode: 'GHCBGHAC' },
      { name: 'Stanbic Bank Ghana', swiftCode: 'SBICGHAC' },
      { name: 'Standard Chartered Ghana', swiftCode: 'SCBLGHAC' },
      { name: 'UBA Ghana', swiftCode: 'UNABORUGHGHAC' },
      { name: 'Zenith Bank Ghana', swiftCode: 'ZEABORUGHGHAC' },
    ],
  },
]

/**
 * Get banks for a specific country code
 */
export function getBanksForCountry(countryCode: string): BankInfo[] {
  const country = SWIFT_CODE_DATA.find(
    (c) => c.countryCode.toUpperCase() === countryCode.toUpperCase()
  )
  return country?.banks || []
}

/**
 * Get country name from code
 */
export function getCountryName(countryCode: string): string {
  const country = SWIFT_CODE_DATA.find(
    (c) => c.countryCode.toUpperCase() === countryCode.toUpperCase()
  )
  return country?.countryName || countryCode
}

/**
 * Check if a country needs SWIFT code help (cross-border payout country)
 */
export function needsSwiftCodeHelp(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false
  const code = countryCode.toUpperCase()
  return ['NG', 'ZA', 'KE', 'GH'].includes(code)
}
