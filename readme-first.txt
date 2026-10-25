NORTHFIELD ENTERPRISE - v9.2
- New Email tab (like the Mills mailbox): Inbox and Sent, showing ONLY mail to/from your own
  domain addresses (the "Send from" list, e.g. eli@ and support@northfieldenterprise.com).
  Personal iCloud mail never appears. Open, reply (choose which address it's from),
  write new emails, or turn an email into a support ticket with one click.
  Nothing is moved or deleted in your mailbox; opening an email marks it read.
- Tickets still only come from the website forms automatically.

=====================================================================

NORTHFIELD ENTERPRISE - v9.1
- Tickets now come ONLY from the website forms. Your iCloud inbox is never read.
- iCloud Mail is used only to SEND replies. Sign in with your @icloud.com address + an
  app-specific password, and list the addresses you send from (e.g. eli@ and support@
  northfieldenterprise.com). When replying you choose which one it comes from.
  Settings > iCloud Mail > Addresses to change the list later.
- "Check for new" buttons removed: the portal refreshes itself every minute and website
  messages arrive instantly.

=====================================================================

NORTHFIELD ENTERPRISE - v9
- Team Portal redesigned in an Apple style: frosted sidebar, big rounded cards, large numbers,
  segmented filters, iOS-style forms in pop-up sheets, iMessage-style ticket conversations.
- "Finish setting up" card on the Overview for admins.
- Import past website data: Overview > Import (or Settings > Website forms > Import past).
  Paste a Netlify personal access token once (Netlify > User settings > Applications >
  Personal access tokens). Every past contact-form message becomes a ticket (older than 14 days
  are marked resolved), every launch sign-up is counted, and contacts are created. Running it
  again never duplicates anything.
- iCloud Mail connect tries the login variations iCloud accepts and explains which email to use.

=====================================================================

NORTHFIELD ENTERPRISE - v8.1: server errors now show a readable reason instead of "502"; helper code moved to netlify/functions/lib.

NORTHFIELD ENTERPRISE - v8 (simpler, automatic Team Portal)

LOOK: Northfield Mills layout, Northfield Enterprise colours. Fewer buttons, filters and boxes.
MENU: Overview, Support, Orders, Reports, Tasks, Contacts | Logo Library, Team, Settings.
  (Company Reports removed - Reports now builds itself. Access requests are inside Team.)

WHAT HAPPENS BY ITSELF
- Website contact form  -> support ticket + contact (instant). Launch sign-ups are counted.
- iCloud Mail inbox     -> support tickets every 10 minutes. Replies to the same conversation
                           are added to the same ticket. Sorted by company (keywords in Settings),
                           category and priority automatically.
- Reply from a ticket   -> emails the customer from your iCloud address; ticket moves to "Waiting".
- Customer answers      -> ticket re-opens. No answer for 7 days -> resolved (changeable).
- Contacts              -> created from everyone who writes in or signs up.
- Reports               -> calculated live from orders and tickets.
- Weekly summary email  -> Mondays, to the addresses in Settings > Automation.
- Amazon orders         -> ready; switch on after launch (below).

SET UP ICLOUD MAIL (once, as an admin)
  1. account.apple.com > Sign-In and Security > App-Specific Passwords > create "NE Portal".
  2. Portal > Settings > iCloud Mail > Connect. Enter your Apple ID email and that password.
     "Send replies from" can be your own-domain address if it's set up in iCloud Mail.

AMAZON (after launch)
  In Netlify > Environment variables (scope: Functions) add AMAZON_LWA_CLIENT_ID,
  AMAZON_LWA_CLIENT_SECRET and AMAZON_REFRESH_TOKEN from Seller Central (Apps & Services >
  Develop Apps), then redeploy. Orders start flowing in within the hour.

NORTHFIELD MILLS: needs the Mills site's netlify/functions folder to connect.

DEPLOYING: this version uses three npm packages (imapflow, nodemailer, mailparser) listed in
package.json. Netlify installs them when it builds from Git or the Netlify CLI. A plain
drag-and-drop upload does not install packages, so mail would not work that way.

=====================================================================

NORTHFIELD ENTERPRISE - v7.4: Team Portal restyled to match the Northfield Mills portal (cream sidebar, red buttons, Mills fonts).

NORTHFIELD ENTERPRISE - v7.2

1. Invites now have their own page: /accept-invite.html ("Create Your Password" / "Create Account").
   Invite links from the email, the homepage or the sign-in page all go there.
2. /set-password.html is now "Change Password" for people who are signed in
   (link in the portal menu: Change password). Old invite links still forward correctly.
3. Sign-in errors now also show Netlify's exact reason in small text underneath.
4. Portal no longer bounces you back to Sign In if the server rejects your session -
   it shows the reason with "Sign in again". It also sends your sign-in token to the server.

CAN'T SIGN IN AND RESET EMAILS DON'T ARRIVE? (emergency owner reset)
  a) Netlify > Site configuration > Environment variables > Add variable
     Key: OWNER_RESET_KEY   Value: a long random phrase (24+ characters). Save.
  b) Scopes must include Functions (or All scopes), and the Production value must be filled.
     Then deploy again: drag the site folder in again (Trigger deploy only exists for Git sites).
  c) Open /owner-reset.html ("Account recovery"), enter your email, that key and a new password. Tick Admin.
  d) Sign in. Then DELETE the OWNER_RESET_KEY variable and redeploy (switches the page off).
  The account must already exist in Netlify > Identity > Users.

=====================================================================

NORTHFIELD ENTERPRISE - v7 (Team Portal)

NEW: /private/portal.html - signing in now lands here. Sections:
  Overview          today's numbers, tickets needing attention, latest orders, my tasks, this month by company
  Customer Support  tickets for every company: category, priority, status, assignee, notes thread, CSV export
  Orders            order log for every company: channel, total, status, tracking; CSV import (Amazon order
                    reports work - matched by column names), CSV template and export
  Tasks             board (To do / In progress / Done) with due dates and owners
  Contacts          customers, suppliers, distributors, retailers, partners
  Reports           revenue by month / company / channel, refunds, tickets by month and category,
                    time to resolve, company summary table; Print / PDF and CSV export
  Company Reports   each company files a monthly/quarterly report (revenue, expenses, orders, highlights,
                    risks, next steps, help needed); admins review and comment; shows who hasn't filed yet
  Team Accounts     (admins) invite, make admin/member, send reset email, re-send invite, remove
  Settings          (admins) company list + colours, sales channels, reporting currency
Logo Library and Access Requests are unchanged and linked from the portal menu.

WHO CAN DO WHAT
  Everyone signed in (logo-user or logo-admin) can view and add/edit records.
  Only admins (logo-admin) can delete records, manage accounts and change settings.

NEW SERVER FILES (upload with the site)
  netlify/functions/portal.mjs  - stores portal data in Netlify Blobs (store "northfield-portal")
  netlify/functions/team.js     - team account management via Netlify Identity
No new Netlify settings needed. Data survives deploys.

=====================================================================

NORTHFIELD ENTERPRISE - v6.1

1. Show/Hide button on every password field (sign in, create password, reset, portal pages).
   Shared script: /assets/pw-toggle.js
2. Forgot Password now talks to Netlify directly and shows Netlify's real answer when
   an email can't be sent (e.g. "Netlify said: 500 - Error sending recovery mail").
   "No team account uses that email" now shows instead of a fake "sent" screen.

IF THE RESET EMAIL STILL DOESN'T ARRIVE - check in this order
a) Try it and read the red message on the page. If it says Netlify couldn't send:
   Netlify > Identity > Emails > Recovery template: either set the path to
   /email-templates/recovery.html AND deploy that folder, or reset it to the default.
   A template path pointing at a file that isn't deployed breaks sending.
b) Netlify > Identity > Users: your user must show as Active (not "Invited").
   Invited users have no password yet - use the invite email or re-send it.
c) Netlify > Identity > Emails > Outgoing emails: if a custom SMTP sender is set, its
   login must still be valid. Remove it to fall back to Netlify's own sender.
d) Check spam/junk.

NORTHFIELD ENTERPRISE - PRODUCTION v6 (password reset)

WHAT'S NEW IN v6
1. New page /forgot-password.html - opened from "Forgot password?" on Team Access.
   Enter email > Send Reset Link > "Check your email" (with a resend option).
   No more browser pop-up asking for the email.
2. New page /reset-password.html - where the link in the reset email lands.
   It checks the link, then shows "Choose a new password" (with Show/Hide).
   Saving signs you in and goes to the Logo Library. Expired or used links show
   "Reset link not valid" with a Request a New Link button.
3. Clear error messages everywhere. The raw "invalid_grant: No user found with that
   email, or password invalid." now reads: "That email and password don't match an
   active account. Check both and try again, or reset your password." (with a link).
   Messages live in /assets/identity-errors.js.
4. Reset links that land on the homepage or /login.html are forwarded to /reset-password.html.
   Old /set-password.html?mode=recovery links also forward there.
5. New branded reset email: /email-templates/recovery.html

ONE-TIME NETLIFY SETUP (recommended)
Netlify > Project configuration > Identity > Emails > Recovery template > Edit
Path to template: /email-templates/recovery.html  > Save.
This makes the email link go straight to /reset-password.html. Without it, the default
email still works (it lands on the homepage and is forwarded).

Upload the whole folder, including /assets and /email-templates.

=====================================================================

NORTHFIELD ENTERPRISE - PRODUCTION v5 (design refresh)

WHAT'S NEW IN v5
1. New look across every public page (home, contact, message sent, terms, 404) and the
   Team Access / Create Password / Logo Library / Admin pages. Wording is unchanged.
2. Homepage: no Team Sign In button beside the sign-up form. "Team Sign In" sits quietly
   at the bottom right of the footer (on every public page) and opens /login.html.
3. /login.html is the Northfield Enterprise Team Access page. It now includes a link to the
   Northfield Mills Team Portal (https://northfieldmills.com/portal). The Logo Library has the
   same link in its header.
4. "Get launch updates" now actually saves sign-ups: Netlify Forms, form name "launch-updates".
   See them in Netlify > Forms. (Before, the form had no field names and saved nothing.)
5. Fixed: broken footer link on the homepage, unclosed fields in the contact form,
   missing favicon-16x16.png / favicon-32x32.png, empty name in site.webmanifest.
6. Homepage uses the real logo from /assets/northfield-enterprise-logo.png (no longer the
   GoDaddy image link). The NE monogram is used as a faint background mark. New section:
   "The businesses we stand behind" with Northfield Mills and NorthTek Industries.
7. New files: /assets/northfield-enterprise-logo.png, /assets/northfield-enterprise-logo-white.png,
   /assets/northfield-mills-logo.webp, /assets/ne-monogram-white.png, /assets/ne-monogram-navy.png,
   /favicon-16x16.png, /favicon-32x32.png. Upload the assets folder with the pages.

No server functions changed. Nothing on the Northfield Mills site or portal changed.

---- v4 notes (still valid) ----

WHAT THIS VERSION FIXES
1. Access requests appear inside /private/admin.html with Accept and Decline buttons.
2. Accept automatically sends the requester a Netlify Identity invitation email.
3. Clicking an Identity invite that lands on the homepage is silently redirected to /login.html with the token preserved.
4. The invite then opens a proper Create Your Password page.
5. Approved users automatically receive the logo-user role after signup.
6. Login is normal email + password after the account is created.
7. Forgot-password callbacks are handled by the same flow.
8. Logo uploads remain in Netlify Blobs and survive future deploys.

ONE-TIME NETLIFY SETUP
- Identity must be enabled.
- Registration must be set to Invite only.
- Your own Identity user must have the role: logo-admin

IMPORTANT OWNER BOOTSTRAP
If your own account is not active yet, invite your own email once from Netlify Identity. With this v4 deployed, clicking that invite will no longer dump you uselessly on the homepage: the homepage detects the invite token and forwards you to Create Your Password. After activating, set your user role to logo-admin once in Netlify Identity.

NORMAL FLOW AFTER THAT
Visitor: /login.html > Request Access.
Owner: /private/admin.html > Accept or Decline.
Accepted visitor: receives Netlify invite > clicks link > Create Password > Logo Library.
Future visits: email + password > Logo Library.

LOCAL TESTING
Static pages can be viewed locally, but Netlify Identity admin invitations, Functions, and Blobs require the Netlify runtime. Use `npx netlify dev` for a linked Netlify project if you want to exercise server functions locally. The actual Identity admin invite operation is supplied by Netlify at runtime.
