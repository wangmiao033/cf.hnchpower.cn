// Database flow synchronization is opt-in for manual R&D billing.
export const RD_AUTO_FLOW_PREFERENCE_KEY = 'cf-rd-billing-auto-flow-v1'

export function readRdAutoFlowPreference(storage) {
  try {
    return storage?.getItem(RD_AUTO_FLOW_PREFERENCE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeRdAutoFlowPreference(storage, enabled) {
  try {
    storage?.setItem(RD_AUTO_FLOW_PREFERENCE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private browsing / disabled storage: current-session toggle still works.
  }
}
