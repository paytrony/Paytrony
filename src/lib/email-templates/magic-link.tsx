import * as React from 'react'
import { Body, Button, Head, Html, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, button, footer } from './_brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Text style={h1}>Your login link</Text>
        <Text style={text}>
          Click the button below to sign in to {siteName}. This link expires shortly and can
          only be used once.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Log in
        </Button>
        <Text style={footer}>
          If you didn't request this link, you can safely ignore this email.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default MagicLinkEmail
