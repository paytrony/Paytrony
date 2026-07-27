import * as React from 'react'
import { Body, Head, Html, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, codeStyle, footer } from './_brand'

interface MagicLinkEmailProps {
  siteName: string
  token: string
}

export const MagicLinkEmail = ({ siteName, token }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} login code</Preview>
    <Body style={main}>
      <Shell>
        <Text style={h1}>Your login code</Text>
        <Text style={text}>
          Enter this 6-digit code in {siteName} to sign in. The code expires shortly and can
          only be used once.
        </Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          If you didn't request this code, you can safely ignore this email.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default MagicLinkEmail
