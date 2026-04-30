const path = require('path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const { rcedit } = await import('rcedit')
  const productFilename = context.packager.appInfo.productFilename
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`)
  const iconPath = path.join(__dirname, 'icon.ico')

  await rcedit(exePath, {
    icon: iconPath
  })
}
