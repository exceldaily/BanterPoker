// Public Supabase coordinates for the shared OrbitStack project.
//
// Both values are PUBLIC by design (the publishable key only ever reaches the
// anon role, which has zero table privileges in the banterpoker schema and can
// only call the security-definer entry points). Environment variables override
// the defaults so previews or a future dedicated project can repoint the app
// without a code change.

export const SUPABASE_URL: string = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://pfagkivkytrvbkhsulvo.supabase.co";
export const SUPABASE_ANON_KEY: string = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_HYyiGQpP3LwfCt0EhSnk3Q_Fplt_UCT";
