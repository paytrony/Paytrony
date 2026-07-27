import * as React from 'react'
import { Body, Head, Html, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, codeStyle, footer } from './_brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your PayTrony verification code</Preview>
    <Body style={main}>
      <Shell>
        <Text style={h1}>Confirm it's you</Text>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code expires shortly. If you didn't request it, you can safely ignore this
          email.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default ReauthenticationEmail
