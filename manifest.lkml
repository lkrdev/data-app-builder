project_name: "data_app_builder"

application: data_app_builder {
  label: "Data App Studio"
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
    use_embeds: yes
    use_iframes: yes
    use_form_submit: yes
    raw_api_request: yes
    core_api_methods: [
      "me",
      "all_lookml_models",
      "lookml_model_explore",
      "run_inline_query",
      "create_query",
      "all_folders",
      "dashboard",
      "create_dashboard",
      "update_dashboard",
      "delete_dashboard",
      "create_dashboard_element",
      "update_dashboard_element",
      "dashboard_layout",
      "update_dashboard_layout",
      "create_dashboard_filter",
      "update_dashboard_filter",
      "dashboard_dashboard_filters",
      "look",
      "create_look",
      "update_look",
      "board",
      "create_board",
      "create_board_section",
      "create_board_item",
      "create_scheduled_plan",
      "scheduled_plans_for_dashboard",
      "scheduled_plans_for_look",
      "artifact",
      "search_artifacts",
      "update_artifacts",
      "delete_artifact",
      "all_user_attributes",
      "create_user_attribute",
      "update_user_attribute"
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
      "https://oauth2.googleapis.com"
    ]
  }
}
