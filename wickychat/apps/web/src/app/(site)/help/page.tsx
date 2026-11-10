import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACT_EMAIL } from '@/components/site-chrome'

export const metadata: Metadata = {
  title: 'Help',
  description: 'How to use WickyChat, for students and teachers at Chadwick International.',
}

const prose =
  'flex flex-col gap-4 text-[14.5px] leading-relaxed text-fg-muted [&_a]:text-accent-text [&_a]:underline [&_h3]:mt-4 [&_h3]:text-[15.5px] [&_h3]:font-semibold [&_h3]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_strong]:text-fg [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ol]:flex [&_ol]:flex-col [&_ol]:gap-1.5'

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[12px] text-fg">
      {children}
    </kbd>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-[14px] text-fg-muted">
      {children}
    </div>
  )
}

export default function HelpPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-[-0.03em]">How to use WickyChat</h1>
      <p className="mt-2 text-[15px] text-fg-muted">
        WickyChat is Chadwick International's own chat, made by Output Club. Pick your guide:
      </p>
      <nav className="mt-6 flex flex-wrap gap-3" aria-label="Guides">
        <a
          href="#students"
          className="rounded-lg border border-border px-4 py-2.5 text-[14.5px] font-medium hover:bg-bg-subtle"
        >
          🎒 For students
        </a>
        <a
          href="#teachers"
          className="rounded-lg border border-border px-4 py-2.5 text-[14.5px] font-medium hover:bg-bg-subtle"
        >
          🍎 For teachers
        </a>
        <a
          href="#questions"
          className="rounded-lg border border-border px-4 py-2.5 text-[14.5px] font-medium hover:bg-bg-subtle"
        >
          ❓ Questions
        </a>
      </nav>

      {/* ------------------------------------------------------------------ */}
      <section id="students" className="mt-14 scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">🎒 For students</h2>
        <div className={`mt-4 ${prose}`}>
          <h3>1. Make your account</h3>
          <ol>
            <li>
              Go to <Link href="/register">wickychat.vercel.app/register</Link>.
            </li>
            <li>
              Use your <strong>@chadwickschool.org</strong> email. Personal emails like Gmail won't
              work.
            </li>
            <li>Pick a password and you're in. Everyone at school lands in the same place.</li>
          </ol>

          <h3>2. Find your way around</h3>
          <ul>
            <li>
              <strong>Home</strong> shows the chats with messages you haven't read yet.
            </li>
            <li>
              The <strong>sidebar</strong> lists your <strong>Channels</strong> (group chats about a
              topic) and <strong>Direct messages</strong> (chats with one or a few people).
            </li>
            <li>
              <strong>Activity</strong> collects your @mentions and replies to your messages.
            </li>
            <li>
              Press <Key>⌘</Key> <Key>K</Key> (Mac) or <Key>Ctrl</Key> <Key>K</Key> (Windows) to
              search and jump to any channel, person or message.
            </li>
          </ul>

          <h3>3. Channels</h3>
          <ul>
            <li>
              <strong>#general</strong> is for everyone. <strong>#announcements</strong> is for
              official news, and only teachers and admins can post there.
            </li>
            <li>
              Click <strong>Browse channels</strong> to find and join others, like clubs or classes.
            </li>
            <li>
              Click <strong>Create channel</strong> to start your own. Make it{' '}
              <strong>private</strong> if only invited people should see it.
            </li>
          </ul>

          <h3>4. Direct messages</h3>
          <ul>
            <li>
              Click <strong>New message</strong> and pick one or more people.
            </li>
            <li>
              You can also message <strong>yourself</strong>. It's a handy place for notes, links
              and reminders.
            </li>
          </ul>

          <h3>5. Sending messages</h3>
          <ul>
            <li>
              Type and press <Key>Enter</Key> to send. <Key>Shift</Key> <Key>Enter</Key> makes a new
              line.
            </li>
            <li>
              Type <strong>@</strong> and a name to mention someone. They'll get a notification.
            </li>
            <li>Drag a file or picture into the chat to share it.</li>
            <li>
              Hover over a message to <strong>react</strong> with an emoji or{' '}
              <strong>reply in thread</strong> (keeps side conversations tidy).
            </li>
            <li>
              Under <strong>More actions</strong> (⋯) you can edit or delete your own message,{' '}
              <strong>Save for later</strong>, forward it, copy a link to it, or turn it into a
              task.
            </li>
            <li>
              Not ready to send now? Use <strong>Schedule message</strong> next to the send button.
            </li>
          </ul>

          <h3>6. Make it yours</h3>
          <ul>
            <li>
              Click your picture to <strong>Set a status</strong> (like "📚 studying") or edit your
              profile.
            </li>
            <li>
              In <strong>Settings → Preferences</strong> you can change the theme (light or dark),
              accent colour, font and how compact things look.
            </li>
            <li>
              In any channel, open <strong>Notifications</strong> to choose "All new messages",
              "Mentions and threads" or "Nothing". Or <strong>Mute</strong> it.
            </li>
          </ul>

          <h3>7. The rules</h3>
          <ul>
            <li>
              WickyChat is a school space. Treat it like a classroom: be kind, no bullying, no spam.
            </li>
            <li>
              Swear words are automatically replaced with <strong>***</strong> for everyone, even
              disguised ones like "sh1t" or "f.u.c.k".
            </li>
            <li>
              Everything you post is tied to your school account, and teachers can remove messages
              in channels.
            </li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section id="teachers" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">🍎 For teachers</h2>
        <div className={`mt-4 ${prose}`}>
          <p>
            Everything in the student guide works for you too. On top of that, teachers can run
            class channels, post announcements and keep chats safe.
          </p>

          <h3>1. Get teacher powers</h3>
          <ol>
            <li>
              Sign up at <Link href="/register">wickychat.vercel.app/register</Link> with your
              @chadwickschool.org email.
            </li>
            <li>
              New accounts start as normal members. Ask a WickyChat owner (Output Club) to make you
              an <strong>Administrator</strong> in <strong>Settings → Members</strong>.
            </li>
          </ol>
          <Note>
            <strong>Administrators</strong> can post announcements, manage every channel, remove
            messages in channels, and change or deactivate accounts. <strong>Owners</strong> can do
            all of that and also make other owners.
          </Note>

          <h3>2. Post an announcement</h3>
          <ul>
            <li>
              Post in <strong>#announcements</strong>. Everyone is in it, and only admins can write
              there, so it stays clean.
            </li>
            <li>
              Use <strong>Schedule message</strong> to have it go out at a set time, for example
              first thing Monday morning.
            </li>
            <li>
              <strong>Pin to channel</strong> keeps important messages easy to find.
            </li>
          </ul>

          <h3>3. Set up a class channel</h3>
          <ol>
            <li>
              Click <strong>Create channel</strong>, name it (e.g. <em>g10-biology</em>) and make it{' '}
              <strong>private</strong>.
            </li>
            <li>Add your students from the channel's member list.</li>
            <li>
              In the channel's <strong>Settings → Permissions</strong>:
              <ul className="mt-1.5">
                <li>
                  Set <strong>Who can post</strong> to <strong>Channel admins only</strong> for a
                  read-only notice board, or leave it on <strong>Everyone</strong> for discussion.
                </li>
                <li>
                  Turn off <strong>Members can add people</strong> so only you decide who joins.
                </li>
              </ul>
            </li>
            <li>
              At the end of the year, <strong>Archive channel</strong>. It's kept but read-only.
            </li>
          </ol>

          <h3>4. Keep chats safe</h3>
          <ul>
            <li>
              <strong>Remove a message:</strong> hover over it, then More actions (⋯), then{' '}
              <strong>Delete</strong>. Channel admins and school admins can delete anyone's message
              in a channel.
            </li>
            <li>
              <strong>Stop an account:</strong> in <strong>Settings → Members</strong>, deactivate
              the person. They lose access to WickyChat until an admin reactivates them.
            </li>
            <li>
              <strong>See what happened:</strong> <strong>Settings → Audit</strong> lists important
              actions such as role changes and removals.
            </li>
            <li>Swear words are filtered automatically before anyone sees them.</li>
          </ul>

          <h3>5. Handy tools</h3>
          <ul>
            <li>
              <strong>Tasks:</strong> turn a message into a task with a due date and assign it.
              People are reminded before it's due.
            </li>
            <li>
              <strong>Threads:</strong> ask students to reply in a thread so one question doesn't
              bury the channel.
            </li>
            <li>
              <strong>Customization</strong> (admins, in Settings): add a welcome message and
              banner, and choose channels every new student joins automatically.
            </li>
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section id="questions" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">❓ Questions</h2>
        <div className={`mt-4 ${prose}`}>
          <h3>It says "WickyChat is only for @chadwickschool.org accounts."</h3>
          <p>You used a personal email. Sign up again with your school email.</p>

          <h3>It says an account with this email already exists.</h3>
          <p>
            You already signed up. Go to <Link href="/login">Sign in</Link> instead.
          </p>

          <h3>I forgot my password.</h3>
          <p>
            Password reset emails aren't switched on yet. Ask an Output Club member or a teacher
            with admin powers for help.
          </p>

          <h3>Can I make voice calls or video meetings?</h3>
          <p>Not yet. They're built in but still being set up for the school.</p>

          <h3>Something's broken or I have an idea.</h3>
          <p>
            Tell Output Club, or email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
      </section>
    </article>
  )
}
