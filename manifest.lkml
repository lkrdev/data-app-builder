project_name: "data_app_builder"

application: data_app_builder {
  label: "Ripper"
  url: "https://localhost:8080/bundle.js"
  # file: "bundle.js"
  mount_points: {
    standalone: yes
    dashboard_tile: yes
  }
  entitlements: {
    local_storage: yes
    navigation: yes
    new_window: yes
    use_clipboard: yes
    use_embeds: yes
    use_iframes: yes
    use_form_submit: yes
    raw_api_request: yes
    new_window_external_urls: [
      "https://*.looker.com/*",
      "https://*.looker.app/*",
      "https://*.google.com/*",
      "https://cloud.google.com/*",
      "https://docs.cloud.google.com/*",
      "https://github.com/*"
    ]
    scoped_user_attributes: [
      "gemini_api_key"
    ]
    oauth2_urls: [
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://oauth2.googleapis.com/token"
    ]
    external_api_urls: [
      "https://generativelanguage.googleapis.com",
      "https://oauth2.googleapis.com",
      "https://cdn.lkr.dev"
    ]
  }
}
