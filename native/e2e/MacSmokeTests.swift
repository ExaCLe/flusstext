import XCTest

final class MacSmokeTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "de.flusstext.native.macos")
  let data = "/private/tmp/flusstext-rn-mac-ui-data"

  func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "mac-" + name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testNativeScreensAndTranscription() throws {
    continueAfterFailure = false
    app.launchEnvironment["FLUSSTEXT_DATA_DIR"] = data
    app.launch()
    XCTAssertTrue(app.buttons["Los geht’s"].waitForExistence(timeout: 60))
    capture("welcome")
    app.buttons["Los geht’s"].click()
    XCTAssertTrue(app.staticTexts["Wähle ein Modell"].waitForExistence(timeout: 15))
    capture("models-onboarding")
    app.buttons["Zurück"].click()
    app.buttons["Überspringen"].click()
    XCTAssertTrue(app.buttons["Einstellungen"].firstMatch.waitForExistence(timeout: 15))
    app.buttons["Einstellungen"].firstMatch.click()
    XCTAssertTrue(app.staticTexts["Bei Anmeldung starten"].waitForExistence(timeout: 15))
    capture("settings")
    app.buttons["Diktat"].firstMatch.click()
    XCTAssertTrue(app.buttons["Zugriff erlauben"].waitForExistence(timeout: 15))
    capture("dictation")
    app.buttons["Modelle"].firstMatch.click()
    XCTAssertTrue(app.staticTexts["Whisper Base"].firstMatch.waitForExistence(timeout: 15))
    capture("models")
    app.buttons["Transkripte"].firstMatch.click()
    XCTAssertTrue(app.buttons["Dateien hinzufügen"].waitForExistence(timeout: 15))
    app.buttons["Dateien hinzufügen"].click()
    app.typeKey("g", modifierFlags: [.command, .shift])
    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.click()
    field.typeText("/private/tmp/flusstext-rn-jfk.wav")
    app.typeKey(.return, modifierFlags: [])
    app.buttons["Open"].firstMatch.click()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'country'")).firstMatch.waitForExistence(timeout: 120))
    capture("transcribed")
    app.terminate()
  }
}
