import AppKit
import ApplicationServices
import UniformTypeIdentifiers
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
enum FlusstextLauncher {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) { app.run() }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  private let reactNativeDelegate: ReactNativeDelegate
  private let factory: RCTReactNativeFactory
  private var window: NSWindow?

  override init() {
    let delegate = ReactNativeDelegate()
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    factory = RCTReactNativeFactory(delegate: delegate)
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    installMenu()
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Flusstext"
    window.minSize = NSSize(width: 600, height: 500)
    window.isReleasedWhenClosed = false
    window.delegate = self
    let container = FileDropView(frame: window.contentView!.bounds)
    let root = factory.rootViewFactory.view(withModuleName: "FlusstextNative")
    root.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(root)
    NSLayoutConstraint.activate([
      root.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      root.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      root.topAnchor.constraint(equalTo: container.topAnchor),
      root.bottomAnchor.constraint(equalTo: container.bottomAnchor)
    ])
    window.contentView = container
    self.window = window
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    window?.makeKeyAndOrderFront(nil)
    return true
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    sender.orderOut(nil)
    return false
  }

  @objc private func grantDictationAccess(_ sender: Any?) {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
  }

  private func installMenu() {
    let bar = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu(title: "Flusstext")
    appMenu.addItem(withTitle: "Über Flusstext", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    let access = appMenu.addItem(withTitle: "Diktat-Zugriff erlauben …", action: #selector(grantDictationAccess(_:)), keyEquivalent: "")
    access.target = self
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Flusstext ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(withTitle: "Flusstext beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    bar.addItem(appItem)
    let editItem = NSMenuItem()
    let edit = NSMenu(title: "Bearbeiten")
    for (title, selector, key) in [("Widerrufen", "undo:", "z"), ("Ausschneiden", "cut:", "x"), ("Kopieren", "copy:", "c"), ("Einsetzen", "paste:", "v"), ("Alles auswählen", "selectAll:", "a")] {
      edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
    }
    editItem.submenu = edit
    bar.addItem(editItem)
    NSApp.mainMenu = bar
  }
}

final class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? { bundleURL() }
  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

final class FileDropView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    registerForDraggedTypes([.fileURL])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  private func files(_ sender: NSDraggingInfo) -> [URL] {
    (sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []).filter {
      let type = try? $0.resourceValues(forKeys: [.contentTypeKey]).contentType
      return type?.conforms(to: .audio) == true || type?.conforms(to: .movie) == true
    }
  }
  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { files(sender).isEmpty ? [] : .copy }
  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    let urls = files(sender)
    guard !urls.isEmpty else { return false }
    NotificationCenter.default.post(name: Notification.Name("FlusstextFileDrop"), object: urls)
    return true
  }
}
