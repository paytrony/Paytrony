import * as React from 'react'
import { Body, Button, Head, Html, Link, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, button, link, footer } from './_brand'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Text style={h1}>Confirm your email change</Text>
        <Text style={text}>
          You requested to change your {siteName} email from{' '}
          <Link href={`mailto:${oldEmail}`} style={link}>
            {oldEmail}
          </Link>{' '}
          to{' '}
          <Link href={`mailto:${newEmail}`} style={link}>
            {newEmail}
          </Link>
          . Confirm the change to continue.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm email change
        </Button>
        <Text style={footer}>
          If you didn't request this change, secure your account immediately by resetting
          your password.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default EmailChangeEmail
