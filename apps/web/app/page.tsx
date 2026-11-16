import { colors } from '@atlas/ui';
export default function Home() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: '80px auto',
        padding: 24,
        fontFamily: 'system-ui',
        color: colors.text,
      }}
    >
      <p>ATLAS / M0</p>
      <h1>A foundation for better teamwork.</h1>
      <p>
        The developer environment is taking shape. Accounts, organizations and
        collaborative work arrive in the next milestones.
      </p>
      <a href="/health/live">Check web health</a>
    </main>
  );
}
