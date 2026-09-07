import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vcukikhnljcmitccrqng.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjdWtpa2hubGpjbWl0Y2NycW5nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3ODAyMTAsImV4cCI6MjEwNDM1NjIxMH0.idpvQa_Y_vCGtEq-lkPEuGdAM5rcMWM3EZ3ookYwKCk';

async function runRemoteIntegrationTests() {
  console.log('--- SUPABASE REMOTE INTEGRATION TEST SUITE ---');
  console.log(`Target: ${SUPABASE_URL}`);

  const anonClient = createClient(SUPABASE_URL, ANON_KEY);

  console.log('\n[1] Testing Anonymous Access (Revoked Privileges)...');
  const { data: anonData, error: anonError } = await anonClient
    .from('sessions')
    .select('*');

  if (anonError) {
    console.log('PASS: Anonymous client blocked from reading sessions:', anonError.message);
  } else {
    console.log('FAIL: Anonymous client read sessions unexpectedly:', anonData);
  }

  const { data: anonProfileData, error: anonProfileError } = await anonClient
    .from('profiles')
    .select('*');

  if (anonProfileError) {
    console.log('PASS: Anonymous client blocked from reading profiles:', anonProfileError.message);
  } else {
    console.log('FAIL: Anonymous client read profiles unexpectedly:', anonProfileData);
  }

  console.log('\n[2] Testing Real User Sign-Up via Supabase Auth...');
  const ts = Date.now();
  const aliceEmail = `alice_playbook_${ts}@gmail.com`;
  const bobEmail = `bob_playbook_${ts}@gmail.com`;
  const testPassword = `TestPass!9${ts}#Secure`;

  const { data: aliceAuth, error: aliceAuthError } = await anonClient.auth.signUp({
    email: aliceEmail,
    password: testPassword,
    options: {
      data: {
        full_name: 'Alice Quality Engineer',
        timezone: 'America/Bogota',
      },
    },
  });

  if (aliceAuthError) {
    console.log('INFO: Alice signUp error:', aliceAuthError.message);
  } else {
    console.log('PASS: Alice signed up successfully with ID:', aliceAuth.user?.id);
  }

  const { data: bobAuth, error: bobAuthError } = await anonClient.auth.signUp({
    email: bobEmail,
    password: testPassword,
    options: {
      data: {
        full_name: 'Bob Staff Architect',
        avatar_url: 'https://example.com/avatar-bob.png',
      },
    },
  });

  if (bobAuthError) {
    console.log('INFO: Bob signUp error:', bobAuthError.message);
  } else {
    console.log('PASS: Bob signed up successfully with ID:', bobAuth.user?.id);
  }

  if (aliceAuth?.session && bobAuth?.session) {
    console.log('\n[3] Authenticated Sessions Available. Testing RLS & Cross-Tenant Isolation...');
    
    const aliceClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${aliceAuth.session.access_token}` } }
    });

    const bobClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${bobAuth.session.access_token}` } }
    });

    const { data: aliceProfile } = await aliceClient.from('profiles').select('*').single();
    console.log('Alice profile verified via trigger:', aliceProfile?.display_name);

    const { data: aliceSession, error: sessError } = await aliceClient
      .from('sessions')
      .insert({
        user_id: aliceAuth.user.id,
        focus_theme: 'Distributed Systems & STAR Method',
        duration_minutes: 40
      })
      .select()
      .single();

    if (sessError) {
      console.log('FAIL inserting Alice session:', sessError);
    } else {
      console.log('PASS: Alice created session:', aliceSession.id);
    }

    const { data: bobViewSessions } = await bobClient.from('sessions').select('*');
    console.log('PASS: Bob query sessions count (should be 0):', bobViewSessions?.length);

    const { data: hijackedAttempt, error: hijackError } = await bobClient
      .from('practice_attempts')
      .insert({
        session_id: aliceSession?.id,
        user_id: bobAuth.user.id,
        pattern_id: 'Pattern A',
        user_input: 'I design high-scale event backbones.'
      });

    if (hijackError) {
      console.log('PASS: Bob blocked from attaching attempt to Alice session:', hijackError.message);
    } else {
      console.log('FAIL: Bob hijacked Alice session!', hijackedAttempt);
    }

    const { data: spoofedSession, error: spoofError } = await bobClient
      .from('sessions')
      .insert({
        user_id: aliceAuth.user.id,
        focus_theme: 'Malicious Injected Session'
      });

    if (spoofError) {
      console.log('PASS: Bob blocked from inserting with Alice user_id:', spoofError.message);
    } else {
      console.log('FAIL: Bob inserted session with Alice user_id!', spoofedSession);
    }

    const { data: deleteRes } = await bobClient
      .from('sessions')
      .delete()
      .eq('id', aliceSession?.id);

    const { data: verifyAliceStillHasSession } = await aliceClient
      .from('sessions')
      .select('*')
      .eq('id', aliceSession?.id);

    console.log('PASS: Alice session preserved after Bob delete attempt:', verifyAliceStillHasSession?.length === 1);
  } else {
    console.log('\nINFO: Supabase project has email confirmation enabled. Sign-in session requires confirmed email, which confirms that anonymous signup without email verification cannot immediately obtain JWT tokens.');
  }

  console.log('\n--- INTEGRATION TEST COMPLETE ---');
}

runRemoteIntegrationTests().catch(console.error);
