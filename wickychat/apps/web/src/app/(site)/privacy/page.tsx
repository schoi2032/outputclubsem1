import type { Metadata } from 'next'
import { CONTACT_EMAIL, LegalDoc } from '@/components/site-chrome'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  return (
    <LegalDoc title="Privacy" updated="November 3, 2026">
      <p>
        WickyChat is run by Output Club at Chadwick International. This page says what we keep and
        why, in plain words.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>
          Your school email, name and profile picture (from Google if you sign in with Google).
        </li>
        <li>The messages, files, reactions and calls you make in WickyChat.</li>
        <li>Basic sign-in info such as device and IP address, so we can keep accounts secure.</li>
      </ul>

      <h2>What we don't do</h2>
      <ul>
        <li>No ads, no selling data, nothing is shared outside the school.</li>
        <li>There is no payment and nothing to buy.</li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li>People in a channel or chat can see its messages.</li>
        <li>School admins and moderators can review reports and messages to keep people safe.</li>
        <li>
          AI features only run when an admin turns them on, and only see what you could already see.
        </li>
      </ul>

      <h2>Where it lives</h2>
      <p>
        WickyChat runs on Vercel, with its database and files stored by Vercel's storage partners.
        Want your data or your account deleted? Email {mail}.
      </p>
    </LegalDoc>
  )
}
