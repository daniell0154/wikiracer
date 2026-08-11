const SUPABASE_URL = 'https://sufghdshsvorkmpvebnx.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ra-Zf63uTaKWE2wN2kIimQ_rYPaYqHQ';

const partyStore = {
  client: null,
  user: null,
  channel: null,
};

function getSupabaseClient() {
  if (!partyStore.client) {
    partyStore.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    });
  }
  return partyStore.client;
}

async function ensurePartyIdentity() {
  const client = getSupabaseClient();
  const current = await client.auth.getUser();
  if (current.data.user) {
    partyStore.user = current.data.user;
    return current.data.user;
  }
  const signedIn = await client.auth.signInAnonymously();
  if (signedIn.error) throw signedIn.error;
  partyStore.user = signedIn.data.user;
  return signedIn.data.user;
}

async function callPartyRpc(name, args) {
  await ensurePartyIdentity();
  const response = await getSupabaseClient().rpc(name, args);
  if (response.error) throw response.error;
  return response.data;
}

async function getPartySnapshot(partyId) {
  const client = getSupabaseClient();
  const [party, members, options, votes] = await Promise.all([
    client.from('parties').select('*').eq('id', partyId).single(),
    client.from('party_members').select('*').eq('party_id', partyId).order('joined_at'),
    client.from('party_options').select('*').eq('party_id', partyId).order('kind').order('position'),
    client.from('party_votes').select('*').eq('party_id', partyId),
  ]);
  const error = party.error || members.error || options.error || votes.error;
  if (error) throw error;
  return { party: party.data, members: members.data, options: options.data, votes: votes.data };
}

function subscribeToParty(partyId, onChange) {
  const client = getSupabaseClient();
  if (partyStore.channel) client.removeChannel(partyStore.channel);
  partyStore.channel = client
    .channel('party:' + partyId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'parties', filter: 'id=eq.' + partyId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members', filter: 'party_id=eq.' + partyId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party_options', filter: 'party_id=eq.' + partyId }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party_votes', filter: 'party_id=eq.' + partyId }, onChange)
    .subscribe();
}

function unsubscribeFromParty() {
  if (partyStore.channel && partyStore.client) partyStore.client.removeChannel(partyStore.channel);
  partyStore.channel = null;
}
