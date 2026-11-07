import SwiftUI

/// Applies point sizing to bundled marks while leaving SF Symbol font sizing to the caller.
struct DSLImageView: View {
    let name: String?
    let symbolName: String?
    let size: Double?

    var body: some View {
        if let image = DSLBundledImageResolver().bundledImage(name) {
            if let size {
                image.resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: CGFloat(size), height: CGFloat(size))
            } else {
                image
            }
        } else {
            Image(systemName: symbolName ?? "questionmark.square.dashed")
        }
    }
}
