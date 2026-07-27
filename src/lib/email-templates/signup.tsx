import * as React from 'react'
import { Body, Head, Html, Link, Preview, Text } from '@react-email/components'
import { Shell, main, h1, text, link, codeStyle, footer } from './_brand'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  token: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  token,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Shell recipient={recipient}>
        <Text style={h1}>Confirm your email</Text>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Enter this 6-digit code to activate your account ({recipient}):
        </Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Shell>
    </Body>
  </Html>
)

export default SignupEmail
