// Paystack Service - Barrel exports for backwards compatibility
// All imports from '../services/paystack.js' continue to work

// Client - base types and utilities
export {
  PAYSTACK_COUNTRIES,
  type PaystackCountry,
  isPaystackSupported,
  generateReference,
  formatPaystackAmount,
  type Bank,
  type ResolvedAccount,
  type Subaccount,
  type TransactionInit,
  type TransactionData,
} from './client.js'

// Banks
export {
  listBanks,
  resolveAccount,
  validateAccount,
} from './banks.js'

// Subaccounts
export {
  createSubaccount,
  getSubaccount,
  updateSubaccount,
  updateSubaccountFee,
} from './subaccounts.js'

// Transactions
export {
  initializePaystackCheckout,
  initializeTransaction,
  verifyTransaction,
  listTransactions,
  listAllTransactions,
  getTransaction,
  type PaystackTransaction,
} from './transactions.js'

// Recurring
export {
  chargeAuthorization,
} from './recurring.js'

// Transfers
export {
  createTransferRecipient,
  initiateTransfer,
  finalizeTransfer,
  resendTransferOtp,
} from './transfers.js'

// Balance
export {
  getBalance,
} from './balance.js'

// Authorizations
export {
  deactivateAuthorization,
  deactivateAuthorizationsBatch,
} from './authorizations.js'
