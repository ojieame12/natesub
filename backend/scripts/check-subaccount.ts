import { getSubaccount } from '../src/services/paystack.js'

async function check() {
  const subaccount = await getSubaccount('ACCT_gdzkjuypj21zwfr')
  console.log('Full subaccount data:')
  console.log(JSON.stringify(subaccount, null, 2))
}

check().then(() => process.exit(0)).catch(e => {
  console.error(e)
  process.exit(1)
})
