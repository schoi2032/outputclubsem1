//! WickyChat desktop: a small, locked-down Rust (Tauri) window around the WickyChat web app.
//!
//! - Opens https://wickychat.vercel.app (or `WICKY_URL`, e.g. `WICKY_URL=http://localhost:3000`).
//! - Starts on a tiny bundled page that checks the connection first, so being offline shows a
//!   friendly "can't reach WickyChat" screen instead of a blank window.
//! - Only WickyChat (and Google sign-in) load inside the window. Every other link opens in the
//!   person's normal browser.
//! - One copy at a time, and the window remembers its size and position.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_URL: &str = "https://wickychat.vercel.app";
const MAIN: &str = "main";

/// Hosts that may load inside the window besides WickyChat itself (sign-in redirects).
const TRUSTED_HOSTS: &[&str] = &["accounts.google.com", "google.com"];

/// Plain Safari, so Google sign-in doesn't refuse an "embedded browser".
#[cfg(target_os = "macos")]
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/// Page zoom for the View menu.
struct Zoom(Mutex<f64>);

fn app_url() -> Url {
    std::env::var("WICKY_URL")
        .ok()
        .and_then(|s| Url::parse(&s).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .unwrap_or_else(|| Url::parse(DEFAULT_URL).expect("valid default URL"))
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// The bundled startup/offline page (`tauri://localhost` on macOS, `http://tauri.localhost` elsewhere).
fn is_bundled(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn allowed_in_window(url: &Url, app: &Url) -> bool {
    if same_origin(url, app) || is_bundled(url) || url.scheme() == "about" || url.scheme() == "data"
    {
        return true;
    }
    url.scheme() == "https"
        && url.host_str().is_some_and(|h| {
            TRUSTED_HOSTS
                .iter()
                .any(|t| h == *t || h.ends_with(&format!(".{t}")))
        })
}

fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Runs in every page: tells the startup page where to go, and turns "open in a new window"
/// links into normal navigation so the rules above decide where they open.
fn init_script(app: &Url) -> String {
    let url = serde_json::to_string(app.as_str()).expect("string");
    format!(
        r#"window.__WICKY_URL__ = {url};
(function () {{
  if (window.__wickyLinks) return;
  window.__wickyLinks = true;
  document.addEventListener('click', function (e) {{
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    if (a.target === '_blank' || e.metaKey || e.ctrlKey) {{
      e.preventDefault();
      location.href = a.href;
    }}
  }}, true);
  window.open = function (u) {{
    if (u) location.href = new URL(String(u), location.href).href;
    return null;
  }};
}})();"#
    )
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let target = app_url();
    let handle = app.clone();
    let nav_target = target.clone();
    let builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("WickyChat")
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 520.0)
        .initialization_script(init_script(&target))
        .on_navigation(move |url| {
            if allowed_in_window(url, &nav_target) {
                true
            } else {
                open_outside(&handle, url);
                false
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(USER_AGENT);
    builder.build()
}

fn focus_main(app: &AppHandle) {
    let win = match main_window(app) {
        Some(w) => w,
        None => match create_window(app) {
            Ok(w) => w,
            Err(_) => return,
        },
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

fn set_zoom(app: &AppHandle, change: Option<f64>) {
    let state = app.state::<Zoom>();
    let mut z = state.0.lock().expect("zoom lock");
    *z = match change {
        Some(step) => (*z + step).clamp(0.5, 2.5),
        None => 1.0,
    };
    if let Some(w) = main_window(app) {
        let _ = w.set_zoom(*z);
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let home = MenuItemBuilder::with_id("home", "Home")
        .accelerator("CmdOrCtrl+Shift+H")
        .build(app)?;
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let in_browser =
        MenuItemBuilder::with_id("in_browser", "Open This Page in Your Browser").build(app)?;
    let help = MenuItemBuilder::with_id("help", "How to Use WickyChat").build(app)?;

    let about = AboutMetadata {
        name: Some("WickyChat".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("Made by Output Club at Chadwick International".into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "WickyChat")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    // Without an Edit menu, copy and paste shortcuts don't work in a macOS web view.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&home)
        .item(&reload)
        .separator()
        .item(&zoom_reset)
        .item(&zoom_in)
        .item(&zoom_out)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&help)
        .item(&in_browser)
        .build()?;

    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        menu = menu.item(&app_menu);
    }
    menu.items(&[&edit, &view, &window, &help_menu]).build()
}

fn on_menu(app: &AppHandle, id: &str) {
    let target = app_url();
    let win = main_window(app);
    match id {
        "home" => {
            if let Some(w) = win {
                let _ = w.navigate(target);
            }
        }
        "reload" => {
            if let Some(w) = win {
                let _ = w.eval("location.reload()");
            }
        }
        "zoom_in" => set_zoom(app, Some(0.1)),
        "zoom_out" => set_zoom(app, Some(-0.1)),
        "zoom_reset" => set_zoom(app, None),
        "help" => {
            if let Ok(u) = target.join("/help") {
                open_outside(app, &u);
            }
        }
        "in_browser" => {
            let current = win
                .and_then(|w| w.url().ok())
                .filter(|u| same_origin(u, &target));
            open_outside(app, &current.unwrap_or(target));
        }
        _ => {}
    }
}

fn main() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the window that's already open.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main(app)
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Zoom(Mutex::new(1.0)))
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
            create_window(&handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting WickyChat")
        .run(|app, event| {
            // macOS: clicking the Dock icon with no window open brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                focus_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
