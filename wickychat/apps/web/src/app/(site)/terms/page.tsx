import type { Metadata } from 'next'
import { CONTACT_EMAIL, LegalDoc } from '@/components/site-chrome'

export const metadata: Metadata = { title: 'Rules' }

export default function TermsPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
  return (
    <LegalDoc title="WickyChat rules" updated="November 3, 2026">
      <p>
        WickyChat is the chat app for Chadwick International students and teachers, built by Output
        Club. By signing in you agree to these rules and to the school's own code of conduct, which
        applies here just like it does in class.
      </p>

      <h2>1. Accounts</h2>
      <ul>
        <li>
          Only @chadwickschool.org accounts can sign up. Use your own account, never someone else's.
        </li>
        <li>
          Everyone is in one organization, Chadwick International. Nobody can create another one.
        </li>
        <li>Keep your password and devices safe. What happens on your account is on you.</li>
      </ul>

      <h2>2. Be decent</h2>
      <ul>
        <li>No bullying, harassment, threats, hate or slurs.</li>
        <li>
          Swear words are filtered automatically. Trying to get around the filter is still breaking
          the rules.
        </li>
        <li>
          No sexual content, no sharing other people's private info, photos or messages without
          permission.
        </li>
        <li>No spam, scams or anything that breaks the law or school policy.</li>
      </ul>

      <h2>3. Moderation</h2>
      <ul>
        <li>
          Admins and teachers can remove messages, deactivate accounts and look at reports. Messages
          are not private from the school.
        </li>
        <li>Serious problems get passed on to the school, the same as anywhere else on campus.</li>
      </ul>

      <h2>4. It's a student project</h2>
      <p>
        WickyChat is free and run by students. It can go down or change, so don't rely on it for
        anything you can't afford to lose. Questions or problems? Email {mail}.
      </p>
    </LegalDoc>
  )
}
