const path = require('node:path')

const output = process.env.QTYPORA_RELEASE_DIR
const runRoot = path.join(__dirname, '.debug', 'package-runs') + path.sep
if (process.platform !== 'darwin') throw new Error('Use npm run package:mac:internal on macOS.')
if (!output || !path.isAbsolute(output) || !path.resolve(output).startsWith(runRoot)) throw new Error('Use the macOS packaging script to create an isolated output directory.')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.qtypora.internal',
  productName: 'QTypora Internal',
  directories: { output, buildResources: 'build' },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    { from: 'build/icon-512.png', to: 'branding/icon.png' },
    { from: 'build/icon.svg', to: 'branding/icon.svg' },
  ],
  fileAssociations: [{ ext: ['md', 'markdown'], name: 'Markdown Document', role: 'Editor' }],
  asar: true,
  npmRebuild: false,
  forceCodeSigning: true,
  publish: null,
  mac: {
    target: ['dmg'],
    category: 'public.app-category.productivity',
    icon: 'build/icon.svg',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    artifactName: 'QTypora-${version}-internal-mac-${arch}.${ext}',
  },
  dmg: {
    artifactName: 'QTypora-${version}-internal-mac-${arch}.${ext}',
    sign: false,
    title: 'QTypora Internal ${version}',
    contents: [
      { x: 140, y: 220 },
      { x: 400, y: 220, type: 'link', path: '/Applications' },
    ],
  },
}
