'use client'
import { PluginDirectory } from '@/components/plugins/directory'
import { SettingsTitle } from '@/components/settings-ui'

export default function PluginsSettings() {
  return (
    <PluginDirectory
      header={(actions) => (
        <SettingsTitle
          title="Plugins"
          description="Add slash commands and automations from other developers. Plugins run on their makers' servers and only see the channels you add them to."
          actions={<div className="flex gap-2">{actions}</div>}
        />
      )}
    />
  )
}
