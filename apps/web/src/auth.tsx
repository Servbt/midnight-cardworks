import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton, useAuth, useUser } from '@clerk/clerk-react';
import type { ReactNode } from 'react';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!publishableKey || publishableKey.includes('replace_me')) return <>{children}</>;
  return <ClerkProvider publishableKey={publishableKey}>{children}</ClerkProvider>;
}

export function AccountPanel({ checkoutMessage }: { checkoutMessage: string }) {
  if (!publishableKey || publishableKey.includes('replace_me')) {
    return <section className="panel narrow">
      <h2>Customer account</h2>
      <p>Clerk is wired in. Add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to enable production sign in, signup, and account management.</p>
      <button>Sign in with Clerk</button>
      {checkoutMessage && <p className="success">{checkoutMessage}</p>}
    </section>;
  }

  return <section className="panel narrow">
    <h2>Customer account</h2>
    <SignedOut>
      <p>Sign in or create an account to save order history and speed up future custom card checkouts.</p>
      <SignInButton mode="modal"><button>Sign in with Clerk</button></SignInButton>
    </SignedOut>
    <SignedIn>
      <AccountSummary />
    </SignedIn>
    {checkoutMessage && <p className="success">{checkoutMessage}</p>}
  </section>;
}

export function useCustomerSession() {
  if (!publishableKey || publishableKey.includes('replace_me')) return { isSignedIn: false, email: undefined as string | undefined };
  const { isSignedIn, user } = useUser();
  return { isSignedIn: Boolean(isSignedIn), email: user?.primaryEmailAddress?.emailAddress };
}

export function useAdminAccess() {
  const { getToken } = useAuth();
  const { isSignedIn, user } = useUser();
  const adminEmails = new Set(
    ((import.meta.env.VITE_ADMIN_EMAILS as string | undefined) ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  const isAdmin = Boolean(isSignedIn && email && adminEmails.has(email));
  return {
    isAdmin,
    async getAdminToken() {
      if (!isAdmin) return undefined;
      return getToken();
    }
  };
}

function AccountSummary() {
  const { user } = useUser();
  return <div className="account-card">
    <p className="success">Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.username ?? 'collector'}</p>
    <UserButton />
  </div>;
}
