// Interverse Studio desktop shell — the whole app is the web frontend; this
// just gives it a native window (Windows now; Tauri also targets iOS later).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Interverse Studio");
}
