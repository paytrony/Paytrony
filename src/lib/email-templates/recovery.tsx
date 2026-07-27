import * as React from 'react'
import { Body, Button, Head, Html, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, button, footer } from './_brand'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Text style={h1}>Reset your password</Text>
        <Text style={text}>
          We received a request to reset your password for {siteName}. Click the button
          below to choose a new one.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Reset password
        </Button>
        <Text style={footer}>
          If you didn't request a password reset, you can safely ignore this email — your
          password won't change.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default RecoveryEmail
