import Stripe from 'stripe'

// Lazy singleton — mirrors supabaseAdmin()'s pattern. Constructed on
// first use so a missing STRIPE_SECRET_KEY only breaks the admin
// billing actions that actually need Stripe, not the whole process.
let _stripe: Stripe | null = null

export function stripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
    _stripe = new Stripe(key)
  }
  return _stripe
}
