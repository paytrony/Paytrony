import * as React from 'react'
import { Container, Section, Text } from '@react-email/components'

// Shared brand tokens for PayTrony auth emails.
// Body background stays #ffffff (email deliverability). The header panel is dark
// to match the app's Aurora look; body copy sits on white below it.
export const brand = {
  green: '#22C55E',
  greenDark: '#16A34A',
  navy: '#0F172A',
  navySoft: '#1E293B',
  text: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  codeBg: '#F1F5F9',
}

export const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: 0,
  padding: '24px 0',
}

export const outerContainer = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '0 16px',
}

export const card = {
  backgroundColor: '#ffffff',
  border: `1px solid ${brand.border}`,
  borderRadius: '14px',
  overflow: 'hidden' as const,
}

export const headerPanel = {
  backgroundColor: brand.navy,
  padding: '22px 28px',
}

export const wordmark = {
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 700 as const,
  letterSpacing: '0.2px',
  margin: 0,
  lineHeight: '24px',
}

export const bodyPad = { padding: '28px' }

export const h1 = {
  fontSize: '22px',
  fontWeight: 700 as const,
  color: brand.text,
  margin: '0 0 16px',
  lineHeight: '1.3',
}

export const text = {
  fontSize: '15px',
  color: brand.text,
  lineHeight: '1.6',
  margin: '0 0 20px',
}

export const button = {
  backgroundColor: brand.green,
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600 as const,
  borderRadius: '8px',
  padding: '13px 24px',
  textDecoration: 'none',
  display: 'inline-block',
}

export const link = { color: brand.greenDark, textDecoration: 'underline' }

export const footer = {
  fontSize: '12px',
  color: brand.muted,
  margin: '28px 0 0',
  lineHeight: '1.5',
}

export const codeStyle = {
  fontFamily: '"SF Mono", Menlo, Consolas, monospace',
  fontSize: '28px',
  fontWeight: 700 as const,
  color: brand.text,
  letterSpacing: '6px',
  backgroundColor: brand.codeBg,
  border: `1px solid ${brand.border}`,
  borderRadius: '10px',
  padding: '16px 20px',
  textAlign: 'center' as const,
  margin: '0 0 20px',
}

// Diamond glyph + wordmark. Uses table for Outlook compatibility.
export const BrandHeader = () => (
  <Section style={headerPanel}>
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ borderCollapse: 'collapse' as const }}
    >
      <tr>
        <td style={{ verticalAlign: 'middle', paddingRight: '10px' }}>
          <div
            style={{
              width: '22px',
              height: '22px',
              backgroundColor: brand.green,
              transform: 'rotate(45deg)',
              borderRadius: '4px',
            }}
          />
        </td>
        <td style={{ verticalAlign: 'middle' }}>
          <Text style={wordmark}>PayTrony</Text>
        </td>
      </tr>
    </table>
  </Section>
)

interface ShellProps {
  children: React.ReactNode
  recipient?: string
}

export const Shell = ({ children, recipient }: ShellProps) => (
  <Container style={outerContainer}>
    <div style={card}>
      <BrandHeader />
      <div style={bodyPad}>{children}</div>
    </div>
    <Text style={footer}>
      PayTrony • <a href="https://paytrony.com" style={link}>paytrony.com</a>
      {recipient ? (
        <>
          <br />
          This email was sent to {recipient}.
        </>
      ) : null}
    </Text>
  </Container>
)
